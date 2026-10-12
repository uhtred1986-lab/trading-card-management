---
title: [P1] Arena: Fix phase durations and Desire hand activation readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 574
status: closed
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/effects.ts, src/lib/arena/vm/activate.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C04.

**Depends on:** #573 (C03)

**Build.** Own remaining #539 bullets: BT3-085/BT3-101 next Charge Phase-only untap restriction; BT2-004 beginning of next turn duration; SD7-01 Desire Activate Main from hand with energy bound and required deck/life shuffle. Keep duration parser distinct from hand activation if a primitive needs its own follow-up.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Restrictions expire at exact declared moment and allow later skill untap; eligible Desire skill is invoked from hand only within cost bound; searched/inspected zones shuffle as printed. The external activation-tax gap remains owned by #677, with an active unsupported boundary below.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates. The live catalog reading diff and DB-backed fuzz 40 remain owner-run under this ticket's no-live-DB constraint, as recorded below.
- [x] One bounded reviewable delivery branch has clear evidence per acceptance bullet and canonical status; PR submission follows final root review. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/effects.ts`, `src/lib/arena/vm/activate.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Implementation evidence (local).** The #539 card rulings are reconciled with Rule Manual v4.00 §§5-11-2 (shuffle each inspected closed area), 12-2-4-1–9 (declare the chosen Extra's skill, move a hand Extra to Drop, waive its original energy and skill costs, resolve it, then resume the invoking effect), and 20-13-5 (a duration ends even when its named phase is skipped). The official [SD7-01 card list](https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=SD7-01&search=true) and [card FAQ](https://www.dbs-cardgame.com/oceania/rule/card_faq.php) are source references for the printed wording and Extra activation ruling. BT2-004's `nextTurn` compiler and turn clock already had the correct reading; the game-level duration assertion protects it without replacing that implementation.

The dedicated `scripts/verify/duration-shuffle-574.ts` checks both engines' real moves: next-opponent-Charge restriction and subsequent Main skill untap, skipped Charge and changed control, including an off-turn lock where the source player's intervening Charge must stand the transferred target and leave the lock for the opponent's due Charge. It checks both ordinary and skipped due Charges and JSON reload at both turn boundaries, BT2-004's next-turn power expiry, SD7 searched Deck and Life shuffle with private identities and JSON reload, and the Desire branch's hand/trait/current-cost selection, Drop-before-skill, cost waiver, line choice, nested ordering, stale choice and reload. A current-cost reduction makes a printed-cost-2 Desire eligible with one energy, which the invoked skill does not spend. Overcost without reduction, wrong trait/zone, failed condition, spent once-per-turn line and a targeted activation prohibition leave the Extra unspent. A compiled external discard tax is recognised by both tax readers but currently omitted on normal and invoked activation; this active unsupported boundary is owned by [#677](https://github.com/uhtred1986-lab/trading-card-management/issues/677). The exact operator shape is asserted in `scripts/verify/readings.ts`.

`DATABASE_URL='' npm run typecheck`, lint (five pre-existing prototype warnings, zero errors), the registered both-engine scenario, `DATABASE_URL='' npm test` (legacy and rules-only; rules-only 51/52 with the pre-existing oracle-only `vm` lane exclusion), `DATABASE_URL='' npm run build`, language/ruleset verification and generated capability checks passed. The generated diff is limited to the new `shuffle`/`invokeSkill`/`afterOpponentCharge` language vocabulary; frozen legacy/probe baselines were not rewritten. The catalog-wide `arena:readings` attempt was read-only and failed with DNS `EAI_AGAIN` for `api.deckplanet.net`. `arena:fuzz` reads live deck/rule rows and has no curated-fixture mode, so it remains owner-run under the no-live-DB constraint. Production/live DB and paid-AI checks remain owner-run.
