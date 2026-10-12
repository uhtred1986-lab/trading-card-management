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
- [x] A Counter pays 1 life without a damage event or total; a later Double Strike takes 2 life in one damage event and records 2. A completed concession with no damage shows genuine zero. Old rules saves without a lifetime counter, and interrupted/abandoned outcomes, show unavailable. The actual game-over consumer is `GameOver`, with [screen evidence](evidence/557/README.md) for fresh zero and old unavailable in both skins at phone and desktop sizes.
- [x] `scripts/verify/damage-statistics-557.mts` checks battle and script damage paths, a paused life replacement, exactly-once completed events, old-save continuation, reload, replay, stale-action refusal and the result component. `scripts/verify/arena-damage-statistics-db.mts` checks PGlite saved revisions, stale CAS, duplicate request idempotency, both seat views and old rows after later damage.
- [x] `DATABASE_URL=''` typecheck, lint (0 errors; 5 existing prototype warnings), full npm test and build pass. `contract:emit` passes and leaves the frozen fixtures and probe digests unchanged. The old named life-cost rules gap is removed; the capability inventory is regenerated. No glossary rule text changes were required for this presentation counter.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Owner-run check:** `arena:fuzz40` uses card-catalog and saved-deck database fixtures and was not run here. No live database, paid AI or production check is claimed. The screenshots use a synthetic contract board; the rules and PGlite scenarios establish engine and persistence behavior.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. The VM state, host, index and battle paths above are shared with other rules work and must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
