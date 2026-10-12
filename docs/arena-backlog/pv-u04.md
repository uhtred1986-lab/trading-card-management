---
title: [P1] Arena: Show Abilities now and collapse wrong-timing abilities
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, blocked, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
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
- [ ] Whis BT1-055's printed Counter appears during its response window. Senzu Bean BT11-053's printed Battle ability is hidden in Counter and appears in the combo window; its one-energy total cost is shown as Blue, and an open viewer refreshes after the phase changes. A separate synthetic Main-skill case verifies the same timing treatment without attributing a nonexistent Main skill to Senzu.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-display.tsx`, `src/components/arena/shared-sheets.tsx`, `src/app/arena/[id]/page.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
