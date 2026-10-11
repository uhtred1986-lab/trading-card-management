---
title: [P1] Arena: Pin immutable match rules and export reproducible replay bundles
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, blocked, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 547
priority: P1
touches: src/lib/arena/games.ts, src/lib/arena/rules-store.ts, src/lib/arena/rulesets/load.ts, src/db/schema.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Match integrity and recovery. **Plan key:** T05.

**Depends on:** #545 (T03)

**Build.** Persist ruleset, catalogue and card-program revision/hash at match creation; cache immutable bundles by revision and viewer-safe reads; export revision, seed and actions for offline reproduction. Define backward-compatible old-game handling. Additive migrations only; no automatic rewrite of existing matches.

**Files to verify first:** `src/lib/arena/games.ts`, `src/lib/arena/rules-store.ts`, `src/lib/arena/rulesets/load.ts`, `src/db/schema.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A card correction changes a newly created game but leaves an ongoing game/replay unchanged; offline replay resolves the same printed/program bundle without a live database.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/games.ts`, `src/lib/arena/rules-store.ts`, `src/lib/arena/rulesets/load.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
