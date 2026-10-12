---
title: [P1] Arena: Fix grouped counts shared conditions and mixed target readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 573
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/targets.ts
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C03.

**Depends on:** #572 (C02)

**Build.** Own #539 BT3-043 shared condition; BT2-001 total Son Goku/Vegeta; BT2-012 per matching card; BT2-009 fill-under-until-five; BT3-084 Battle Cards AND energy; BT31-090 combined sum bound (check #508 already solved before changes). Preserve distinctions among OR, AND and exact count.

**Source ruling.** #539's six card bullets have no follow-up comments. The [official BT2-009 card list](https://www.dbs-cardgame.com/asia/cardlist/index.php?category=428002&free=BT2-009&search=true) prints the fill-until-five clause; the [official card FAQ](https://www.dbs-cardgame.com/canada/rule/card_faq.php) says BT2-009 Q1 places a total of five under the Ball and Q4 places none without that host. Its BT2-012 Q2 counts all matching Son Goku and Vegeta cards together.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Every owned bullet gets expected program and behavior, including nonmatching cards, totals at threshold, partial capacity, and both selected zones; report already-correct redrafts. **Compiler result:** BT3-043's shared blue Leader/life condition, BT2-001's single total, BT2-012's per-card gain, BT3-084's two opponent areas, and BT31-090's combined cost bound were already correct and remain pinned without rewriting them. BT2-009 now compiles its exact same named host and bounded total using an existing host choice, live under-count guards and ordered one-card top-deck moves. **Runtime completion in #672:** current DBS rules-engine games resolve BT3-043’s card-specific Auto at genuine combo entry, including its conditional +10000 before combat and return/draw before the next combo offer. The shared condition and all grouped readings remain pinned. Legacy runtime and archived older DSL preserve their historical late timing; this is a default/current-DSL correctness claim, not legacy retirement.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** `grouped-readings-573.ts` exercises the grouped readings and the actual KO-triggered BT2-009 Auto in both engines: 0/2/5/6 cards under one host, a short deck, no host or wrong owner/zone, and two eligible hosts with a JSON-reloaded choice and rejected stale selection. It checks top-deck consumption, ordered stack events, no Energy charge, KO, both-viewer hidden-card projection and engine-specific existing stack order. A real BT3-043 combo now asserts the current rules-engine entry skill event and conditional 25000 combat comparison; the legacy lane retains its historical 15000/late behavior. Both conditions control the draw, and #672 adds both-player return, source, cost and reload proofs.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, lint (five existing prototype warnings; zero errors), both registered Arena engines (49/49 each), `DATABASE_URL='' npm test` (legacy 49/49; rules-only 48/49 with the prior saved-legacy lane exclusion), and `DATABASE_URL='' npm run build` pass. The glossary distinguishes current combo-entry timing from the legacy/pinned older DSL boundary. The capability inventory records bounded fill and current-DSL entry as supported narrow scenarios, with four separate named runtime gaps. `npm run arena:readings` was attempted but Deckplanet DNS returned `EAI_AGAIN`; live catalog reading-diff signoff remains owner-run. `arena:fuzz -- 40` requires database access and remains owner-run, not a claimed pass.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed. **Evidence:** draft [PR #673](https://github.com/uhtred1986-lab/trading-card-management/pull/673) referenced #573 without closing it at that stage. PR #673 delivered the bounded fill reading, and #672 supplies the missing current-DSL entry timing; this canonical record closes with that completion. no live database write, paid call, production catalog check or deployment is claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/targets.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
