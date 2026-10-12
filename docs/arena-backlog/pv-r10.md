---
title: [P2] Arena: Report genuine damage statistics for rules-engine games
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 557
priority: P2
touches: src/lib/arena/engines.ts, src/lib/arena/vm/state.ts, src/lib/arena/vm/index.ts, src/lib/arena/vm/host.ts, src/lib/arena/vm/battle.ts, src/components/arena/GameOver.tsx, src/app/arena/[id]/page.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Rule engine correctness. **Plan key:** R10.

**Depends on:** #544 (T02)

**Build.** Replace rules-engine zero placeholders with event-derived damage accounting; distinguish damage from life spent as a cost and interrupted outcomes. Until counts are available label them unavailable on the game-over screen.

**Files to verify first:** `src/lib/arena/engines.ts`, `src/components/arena/GameOver.tsx`, `src/app/arena/[id]/page.tsx`, and the rules VM's `damage` event paths. `ReviewScreen.tsx` is the admin flag replay, not this statistic's consumer. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Damage 2 and life paid 1 remain different totals; a zero-damage completed game shows real zero; an old unsupported statistic displays unavailable.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. The VM state, host, index and battle paths above are shared with other rules work and must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
