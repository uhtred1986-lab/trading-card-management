---
title: [P2] Arena: Skip unchanged snapshot loads with revision-aware polling
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 568
priority: P2
touches: src/lib/arena/games.ts, src/lib/arena/snapshot.ts, src/components/arena/stage/useLiveGame.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S04.

**Depends on:** #545 (T03), #565 (S01)

**Build.** Return unchanged by revision/ETag before expensive full game projection; reduce idle beat-counter reads and transfer while keeping authenticated access and terminal updates. Measure before/after. Consider push transport only in a separate measured proposal.

**Files to verify first:** `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Idle viewers have fewer measured reads/bytes; no-beat status changes still arrive; reconnect and old cursors retrieve complete authorized state.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
