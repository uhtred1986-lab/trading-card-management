---
title: [P1] Arena: Keep Aegis payment choices eligible after each selection
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 555
priority: P1
status: closed
touches: src/lib/arena/vm/keyword-do.ts, src/lib/arena/glossary.ts, scripts/verify/aegis-555.ts, scripts/verify/readings.ts, scripts/verify/keywords.ts, scripts/verify-arena.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R08.

**Depends on:** None; ready for an isolated implementation.

**Build.** Derive Aegis's choice continuation from its `keywords.rules` body: choose one initial card from the declared colors, then offer only cards covering a still-missing distinct color. Move the selected cards as the declared cost only after coverage is complete, and retain the continuation in the existing persisted script frame.

**Files to verify first:** `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/keyword-do.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] After the first pick only valid remaining colour/payment combinations are offered; impossible partial choices are refused without paying twice.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; glossary and reading diff reviewed. Real-deck arena:fuzz40 is owner-run because it requires the arena database; no live database, paid AI or production checks were run.
- [x] One bounded PR with evidence per acceptance item; draft PR [#596](https://github.com/uhtred1986-lab/trading-card-management/pull/596) opened, canonical status closed.

**Evidence and limits.** `DATABASE_URL='' npx tsx scripts/verify/aegis-555.ts --engine rules`, `DATABASE_URL='' npx tsx scripts/verify-arena.ts --engine rules` (29/29, no failures), `DATABASE_URL='' npx tsx scripts/verify-rules.ts`, `DATABASE_URL='' npm run typecheck`, `DATABASE_URL='' npm run lint`, `DATABASE_URL='' npm test`, and `DATABASE_URL='' npm run build` passed. `scripts/verify/aegis-555.ts` exercises both first-pick orders, two distinct mono-color cards, a single multi-color card, duplicate and three-color parameters, impossible coverage, stale invalid answers without a second payment, and reload between picks. The printed-orb-before-hand-cost sequence remains a known rules-order gap: 22-30-3 says the hand cards are the skill cost and then says to determine/pay any additional skill cost; follow-up #595 tracks that separate ordering correction. The current selector uses the VM's existing color view; fidelity to 22-30-3's “original colors” is being reviewed under #553. `arena:fuzz40` is owner-run because `scripts/arena-fuzz.mts` loads real arena deck rows; `DATABASE_URL` is intentionally empty here because the available credential belongs to another app. No paid AI or production checks were run.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/keyword-do.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
