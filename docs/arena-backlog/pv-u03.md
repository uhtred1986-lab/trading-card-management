---
title: [P1] Arena: Extend the existing phone pager to tap-open fullscreen review
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
issue: 560
priority: P1
touches: src/components/arena/shared-sheets.tsx, src/components/arena/stage/Hand.tsx, src/components/arena/stage/StageCard.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Extends completed phone pager #348.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U03.

**Depends on:** #559 (U02)

**Build.** Extend completed #348 with a visible Inspect/expand control and full-screen artwork plus swipe/prev-next/position; ordinary hand review should not require long press. Preserve charge/play/target selection priorities with named actions and gesture arbitration; never make an inspection tap commit a play. Use card-instance identity for duplicate cards.

**Files to verify first:** `src/components/arena/shared-sheets.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageCard.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Tap Inspect hand, swipe across 20 instances (including duplicate card IDs), page by keyboard, inspect a board card, close with focus restored, and confirm the hand list is unchanged; the affordance calls only the existing inspect handler, leaving Charge/play/target handlers untouched.
- [x] The DB-free browser harness checks 20 unique instance IDs/thumbs, actual loaded artwork, 44px in-viewport pager/close targets, swipe and ArrowLeft navigation, Escape focus restoration and board-card inspection. The preview fixture is temporary and removed in `finally`.
- [x] Typecheck, lint, relevant arena scenarios, npm test and build pass. This UI-only change does not alter game rules, VM/compiler behavior or glossary fixtures.
- [x] Before/after app captures from unchanged `74701713f89012b0dc89957d9bcb92d4803b7275` and the candidate cover 1440px and 390px in both skins, plus 390×650 and 320×568 at 200% text with reduced motion. The README in `docs/arena-backlog/evidence/560/README.md` documents fixture differences, artwork and reproduction commands.
- [x] One bounded draft PR has evidence per acceptance item; canonical backlog status is closed. No live database, paid AI, or production checks were used.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-sheets.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageCard.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Owner-run checks:** No live database, paid AI, or production-settings access was used. Commands ran locally with `DATABASE_URL=''`; the artwork mapping is confined to a temporary screenshot fixture and does not change catalog data.
