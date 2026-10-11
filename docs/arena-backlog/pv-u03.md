---
title: [P1] Arena: Extend the existing phone pager to tap-open fullscreen review
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, blocked, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
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
- [ ] Tap review, swipe through 12–20 hand cards including duplicates, inspect board cards, close and retain selection; Charge and targeting gestures remain deliberate; controls work with keyboard.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-sheets.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageCard.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
