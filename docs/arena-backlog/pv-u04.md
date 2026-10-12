---
title: [P1] Arena: Show Abilities now and collapse wrong-timing abilities
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
issue: 561
priority: P1
touches: src/components/arena/shared-display.tsx, src/components/arena/shared-sheets.tsx, src/app/arena/[id]/page.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U04.

**Depends on:** #558 (U01), #560 (U03)

**Build.** Use the real-artwork draft's Abilities now panel in desktop selection and fullscreen review. Show legal manual ability name, cost, consequence and Activate; hide wrong round/phase/window/zone abilities under collapsed Other abilities by default. Show resource-blocked timely abilities with an actionable reason. Separate passives and pending Autos; never offer an Auto as a manual button.

**Files to verify first:** `src/components/arena/shared-display.tsx`, `src/components/arena/shared-sheets.tsx`, `src/app/arena/[id]/page.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Whis BT1-055's printed Counter appears during its response window. Senzu Bean BT11-053's printed Battle ability is hidden in Counter and appears in the combo window; its one-energy total cost is shown as Blue, and an open viewer refreshes after the phase changes. A separate synthetic Main-skill case verifies the same timing treatment without attributing a nonexistent Main skill to Senzu.
- [x] Positive, negative and interaction cases appropriate to this change have explicit state/cost/event assertions in `scripts/verify/abilities-now-561.ts` and the DB-free EngineAPI browser harness. The browser harness applies the exact offered Whis Counter and Senzu Activate actions and asserts payment, movement, events, prompt continuation, current-view refresh and fullscreen navigation.
- [x] Typecheck, lint, rules/arena verification, npm test and build pass. This UI change does not alter VM/compiler behavior or glossary fixtures.
- [x] Actual BT11-053 and BT1-055 artwork captures cover 1440 and 390 in both skins, plus 390×650 and 320×568 at 200% text. The phone harness checks keyboard focus and real touch-scroll reachability with the fixed close control visible, reduced motion, no horizontal overflow, fullscreen ability discoverability and phase refresh. Evidence and reproduction steps are in `docs/arena-backlog/evidence/561/README.md`.
- [x] One bounded draft PR is prepared with evidence per acceptance item; canonical backlog status is closed. No live database, paid AI, or production checks were used.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-display.tsx`, `src/components/arena/shared-sheets.tsx`, `src/app/arena/[id]/page.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Owner-run checks:** No live database or paid AI calls were used. `DATABASE_URL=''` was set for checks. The browser uses an EngineAPI-generated Snapshot and action callback with a mocked HTTP transport; it does not change runtime polling or catalog data. The full suite still reports separately tracked engine-rule gaps, none introduced by this UI work.
