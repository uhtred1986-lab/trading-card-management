---
title: [P2] Arena: Share immutable derived evaluation by match revision
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-vm, phase:hud-workflow, model:opus-5, performance
stage: ui
issue: 569
priority: P2
touches: src/lib/arena/snapshot.ts, src/lib/arena/vm/effects.ts, src/lib/arena/vm/view.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S05.

**Depends on:** #547 (T05), #565 (S01), #568 (S04)

**Build.** Profile first; share board-static evaluation among legal/rejection/view for one immutable revision and cache pinned definitions. Scope to the measured bottleneck. Key personalized caches by viewer and revision; preserve freshness and invalidate on revision changes.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/view.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Crowded aura fixture improves against S01 baseline while snapshots/legal outcomes match; two viewers cannot share hidden data; updated state cannot reuse old derived effects.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/view.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Bounded measured child:** #607 (P1) profiles and reduces evaluation cost inside corrected zero-power checkpoints. It is independent of polling #568; this parent retains broader immutable-revision sharing across legality, rejection and views.
