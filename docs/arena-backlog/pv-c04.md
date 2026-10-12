---
title: [P1] Arena: Fix phase durations and Desire hand activation readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, blocked, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 574
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/effects.ts, src/lib/arena/vm/activate.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C04.

**Depends on:** #573 (C03)

**Build.** Own remaining #539 bullets: BT3-085/BT3-101 next Charge Phase-only untap restriction; BT2-004 beginning of next turn duration; SD7-01 Desire Activate Main from hand with energy bound and required deck/life shuffle. Keep duration parser distinct from hand activation if a primitive needs its own follow-up.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Restrictions expire at exact declared moment and allow later skill untap; eligible Desire skill is invoked from hand only within cost bound; searched/inspected zones shuffle as printed.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Implementation evidence (local, pending full gates).** The #539 card rulings are reconciled with Rule Manual v4.00 §§5-11-2 (shuffle each inspected closed area), 12-2-4-1–9 (declare the chosen Extra's skill, move a hand Extra to Drop, waive its original energy and skill costs, resolve it, then resume the invoking effect), and 20-13-5 (a duration ends even when its named phase is skipped). The official [SD7-01 card list](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=SD7-01&search=true) and [card FAQ](https://www.dbs-cardgame.com/oceania/rule/card_faq.php) are source references for the printed wording and Extra activation ruling. BT2-004's `nextTurn` compiler and turn clock already had the correct reading; the game-level duration assertion protects it without replacing that implementation.

The dedicated `scripts/verify/duration-shuffle-574.ts` checks both engines' real moves: next-opponent-Charge restriction and subsequent Main skill untap, skipped Charge and changed control, BT2-004's next-turn power expiry, SD7 searched Deck and Life shuffle with private identities and JSON reload, and the Desire branch's hand/trait/current-cost selection, Drop-before-skill, cost waiver, line choice, nested ordering, stale choice and reload. Overcost, wrong trait/zone, failed condition, spent once-per-turn line and a targeted activation prohibition leave the Extra unspent. The exact operator shape is asserted in `scripts/verify/readings.ts`. `typecheck`, lint and direct scenarios passed after commits `1fb5868` and `abaf374`; lint reports five existing warnings in the design prototype and zero errors.

The catalog-wide `arena:readings` attempt was read-only and failed with DNS `EAI_AGAIN` for `api.deckplanet.net`. `arena:fuzz` reads live deck/rule rows and has no curated-fixture mode, so it remains owner-run under the no-live-DB constraint. Production/live DB and paid-AI checks remain owner-run. Full `npm test`, build, generated contract and inventory verification are still pending integration and scheduling; they are not claimed here.
