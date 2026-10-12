---
title: [P1] Arena: Fix grouped counts shared conditions and mixed target readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 573
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/targets.ts
status: partial
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C03.

**Depends on:** #572 (C02)

**Build.** Own #539 BT3-043 shared condition; BT2-001 total Son Goku/Vegeta; BT2-012 per matching card; BT2-009 fill-under-until-five; BT3-084 Battle Cards AND energy; BT31-090 combined sum bound (check #508 already solved before changes). Preserve distinctions among OR, AND and exact count.

**Source ruling.** #539's six card bullets have no follow-up comments. The [official BT2-009 card list](https://www.dbs-cardgame.com/asia/cardlist/index.php?category=428002&free=BT2-009&search=true) prints the fill-until-five clause; the [official card FAQ](https://www.dbs-cardgame.com/canada/rule/card_faq.php) says BT2-009 Q1 places a total of five under the Ball and Q4 places none without that host. Its BT2-012 Q2 counts all matching Son Goku and Vegeta cards together.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Every owned bullet gets expected program and behavior, including nonmatching cards, totals at threshold, partial capacity, and both selected zones; report already-correct redrafts. **Compiler result:** BT3-043's shared blue Leader/life condition, BT2-001's single total, BT2-012's per-card gain, BT3-084's two opponent areas, and BT31-090's combined cost bound were already correct and remain pinned without rewriting them. BT2-009 now compiles its exact same named host and bounded total using an existing host choice, live under-count guards and ordered one-card top-deck moves. **Remaining behavior:** BT3-043's card-specific “when you combo” Auto currently resolves only when the card leaves Combo at battle cleanup, so its +10000 cannot affect combat; [#672](https://github.com/uhtred1986-lab/trading-card-management/issues/672) owns this separate combo-entry trigger timing. `grouped-readings-573.ts` asserts the current combat boundary explicitly rather than claiming the card is fully correct.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** `grouped-readings-573.ts` exercises the grouped readings and the actual KO-triggered BT2-009 Auto in both engines: 0/2/5/6 cards under one host, a short deck, no host or wrong owner/zone, and two eligible hosts with a JSON-reloaded choice and rejected stale selection. It checks top-deck consumption, ordered stack events, no Energy charge, KO, both-viewer hidden-card projection and engine-specific existing stack order. A real BT3-043 combo shows no entry skill event and only printed Combo Power in the combat comparison, while its delayed draw obeys both conditions.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, lint (five existing prototype warnings; zero errors), both registered Arena engines (49/49 each), `DATABASE_URL='' npm test` (legacy 49/49; rules-only 48/49 with the prior saved-legacy lane exclusion), and `DATABASE_URL='' npm run build` pass. The glossary distinguishes #672 timing from this reading, and the generated capability inventory records both the supported bounded fill and the active unsupported timing boundary (29 scenarios; 4 named runtime gaps). `npm run arena:readings` was attempted but Deckplanet DNS returned `EAI_AGAIN`; live catalog reading-diff signoff remains owner-run. `arena:fuzz -- 40` requires database access and remains owner-run, not a claimed pass.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
