---
title: [P1] Arena: Bind end-of-battle Auto to this card comboed from hand
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 572
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/vm/triggers.ts
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C02.

**Depends on:** #571 (C01)

**Build.** Own #539 BT6-010 and BT2-010 bullets: battleEnd must be bound to that source having comboed from hand, with BT6-010 opponent-turn restriction. Use event/source binding rather than generic battleEnd.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/vm/triggers.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Same battle without this card, combo from another zone and wrong turn do not fire; a legal hand combo fires once at battle end. **Evidence:** `scripts/verify/hand-combo-572.ts` exercises actual hand and Battle Area combos on both engines, an unrelated card's combo, BT6-010 on each player's turn, and the matched card's single skill event after cleanup. `scripts/verify/readings.ts` pins BT6-010 and BT2-010 source and turn readings from #539.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** the scenario checks the same card instance entering Combo, leaving for Drop, and returning to Battle in Rest Mode; a zero-cost combo leaves Energy Active. JSON reload retains provenance. Mid-battle departure, Z-Energy choice, another battle, and two independent sources in one battle do not borrow hand origin. An old saved battle missing provenance interrupts before the Auto can resolve, with no winner or card play; the rules engine persists a typed outcome and projects no private diagnostic to either viewer. The legacy engine refuses the action without changing the saved state.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, `npm run lint` (five existing prototype warnings, zero errors), `npm test` (legacy 48/48; rules-only 47/48 with named prior gaps; capability guard check), and `npm run build` passed. The glossary and generated capability inventory describe the narrow behavior and old-save guard. `npm run arena:readings` was attempted but Deckplanet DNS returned `EAI_AGAIN`, so the live catalog reading diff remains owner-run; fixed official-text assertions passed. `arena:fuzz -- 40` requires database access and remains owner-run, not a claimed pass.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed. **Evidence:** draft PR [#670](https://github.com/uhtred1986-lab/trading-card-management/pull/670) covers #572; no live database writes, paid AI, or production catalog checks were performed.

**Scope notes.** Provenance lives on the active battle, records the actual entry area, and is discarded after that card's Combo Area departure; it is not inferred from the card's later zone. The separate cleanup checkpoint ordering limitation remains #609. Old saves without the new origin record stop visibly if a hand-qualified Auto is due.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/vm/triggers.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
