---
title: [P1] Arena: Measure arena acknowledgement polling AI and rendering costs
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 565
priority: P1
touches: src/lib/arena/snapshot.ts, src/lib/arena/games.ts, src/components/arena/stage/useLiveGame.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Create reproducible local benchmark fixtures and sanitized timings for apply/legal/rejection/view, DB queries, response bytes, persisted acknowledgement, AI and browser frame cost. Report p50/p95 by board/effect/history size; separate local CPU from hosted results. No paid/live calls required for agent proof.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/lib/arena/games.ts`, `src/components/arena/stage/useLiveGame.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Small and crowded aura fixtures yield reproducible phase-separated measurements; idle query count and long-match payload are recorded; no secrets/hidden hands appear in logs. Hosted p95/representative phone remain clearly owner-run where unavailable.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/lib/arena/games.ts`, `src/components/arena/stage/useLiveGame.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
