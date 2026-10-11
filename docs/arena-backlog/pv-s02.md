---
title: [P1] Arena: Acknowledge human actions before resumable AI advance
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 566
priority: P1
touches: src/app/arena/actions.ts, src/lib/arena/games.ts, src/lib/arena/ai/opponent.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S02.

**Depends on:** #545 (T03), #565 (S01)

**Build.** Return persisted player snapshot promptly; consolidate web/HTTP advance through a bounded resumable path and per-game revision lease. Prevent duplicate model calls, release/recover failed lease and expose resume. Maintain authoritative revision/CAS; use mocked AI for proof.

**Files to verify first:** `src/app/arena/actions.ts`, `src/lib/arena/games.ts`, `src/lib/arena/ai/opponent.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Slow mocked AI never delays player acknowledgement; two simultaneous advances produce one decision call; crash/retry resumes without applying or billing a duplicate decision.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/app/arena/actions.ts`, `src/lib/arena/games.ts`, `src/lib/arena/ai/opponent.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
