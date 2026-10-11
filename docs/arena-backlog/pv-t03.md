---
title: [P0] Arena: Use monotonic game revision and action identity across clients
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 545
priority: P0
touches: src/lib/arena/games.ts, src/lib/arena/snapshot.ts, src/components/arena/stage/useLiveGame.ts, src/app/arena/actions.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Match integrity and recovery. **Plan key:** T03.

**Depends on:** None; ready for an isolated implementation.

**Build.** Expose authoritative game revision independent of beat sequence; increment on all relevant state/status writes including abandonment; require freshness and request identity in web/HTTP actions, retain CAS, reconcile responses monotonically. Update shared contract and emitted fixtures.

**Files to verify first:** `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts`, `src/app/arena/actions.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Two clients see a no-beat abandonment; delayed lower revision never replaces newer state; duplicate actions apply once; competing actions return a typed stale response.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
